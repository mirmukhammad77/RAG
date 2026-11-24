import { BadGatewayException, BadRequestException, HttpException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { MAX_PDF_BYTES } from '../documents.constants';

export function isPublicAddress(address: string): boolean {
  try {
    // process() unwraps IPv4-mapped IPv6 addresses before range classification.
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

interface Download { buffer?: Buffer; redirect?: string }

@Injectable()
export class PdfDownloadService {
  async download(source: string): Promise<Buffer> {
    const signal = AbortSignal.timeout(30_000);
    let current = source;
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const url = new URL(current);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new BadRequestException('Use a public HTTP or HTTPS link without embedded credentials.');
        }
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(hostname)
          ? [{ address: hostname, family: isIP(hostname) }]
          : await this.resolve(hostname, signal);
        signal.throwIfAborted();
        if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
          throw new BadRequestException('The PDF link must resolve to a public internet address.');
        }
        // Pin the request to the validated address so a second DNS lookup cannot rebind it.
        const result = await this.fetch(url, addresses[0], signal);
        if (result.buffer) return result.buffer;
        current = new URL(result.redirect!, url).href;
      }
      throw new BadRequestException('The PDF link redirects too many times.');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof TypeError && !signal.aborted) throw new BadRequestException('Invalid PDF URL.');
      throw new BadGatewayException('Could not download the PDF. Check that the link is publicly accessible and returns a PDF within 30 seconds.');
    }
  }

  private resolve(hostname: string, signal: AbortSignal): Promise<LookupAddress[]> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = (): void => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      // OS DNS lookups do not accept AbortSignal. Bound the caller's wait as well
      // as the subsequent HTTP request to the same overall download deadline.
      lookup(hostname, { all: true }).then(
        (addresses) => { signal.removeEventListener('abort', abort); resolve(addresses); },
        (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
      );
    });
  }

  private fetch(url: URL, address: { address: string; family: number }, signal: AbortSignal): Promise<Download> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal,
        headers: { Accept: 'application/pdf', 'Accept-Encoding': 'identity', 'User-Agent': 'TextbookRAG/0.1' },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      }, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          resolve({ redirect: response.headers.location });
          response.destroy();
          return;
        }
        if (status !== 200) {
          reject(new BadGatewayException(`The PDF server returned HTTP ${status}.`));
          response.destroy();
          return;
        }
        if (Number(response.headers['content-length']) > MAX_PDF_BYTES) {
          reject(new PayloadTooLargeException('PDF must be 50 MiB or smaller.'));
          response.destroy();
          return;
        }
        const buffers: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > MAX_PDF_BYTES) {
            reject(new PayloadTooLargeException('PDF must be 50 MiB or smaller.'));
            response.destroy();
          } else buffers.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ buffer: Buffer.concat(buffers) }));
      });
      request.on('error', reject);
      request.end();
    });
  }
}
