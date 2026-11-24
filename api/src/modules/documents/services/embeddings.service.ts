import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../documents.constants';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractor?: Promise<FeatureExtractionPipeline>;

  constructor(private readonly config: ConfigService) {}

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        return pipeline('feature-extraction', EMBEDDING_MODEL, {
          dtype: 'q8',
          device: 'cpu',
          cache_dir: this.config.getOrThrow<string>('MODEL_CACHE_DIR'),
        });
      })().catch((error: unknown) => {
        this.extractor = undefined;
        this.logger.error('Could not load MiniLM. Check model download access and MODEL_CACHE_DIR.', error instanceof Error ? error.message : undefined);
        throw new ServiceUnavailableException('Embedding model is unavailable. Please retry after the model can be downloaded.');
      });
    }
    return this.extractor;
  }

  async tokenCounter(): Promise<(text: string) => number> {
    const extractor = await this.load();
    return (text) => extractor.tokenizer.encode(text, { add_special_tokens: false }).length;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    const embeddings: number[][] = [];
    try {
      for (let offset = 0; offset < texts.length; offset += 16) {
        const batch = texts.slice(offset, offset + 16);
        // No implicit truncation: callers must split passages or reject long queries first.
        if (batch.some((text) => extractor.tokenizer.encode(text).length > 256)) {
          throw new Error('Embedding input exceeds the MiniLM context window');
        }
        const result = await extractor(batch, { pooling: 'mean', normalize: true });
        const vectors = result.tolist() as number[][];
        if (vectors.length !== batch.length || vectors.some((vector) =>
          vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)) ||
          !vector.some((value) => value !== 0))) {
          throw new Error('Invalid MiniLM embedding output');
        }
        embeddings.push(...vectors);
      }
      return embeddings;
    } catch (error) {
      this.logger.error('MiniLM embedding failed', error instanceof Error ? error.message : undefined);
      throw new ServiceUnavailableException('Could not generate embeddings. Please retry.');
    }
  }
}
