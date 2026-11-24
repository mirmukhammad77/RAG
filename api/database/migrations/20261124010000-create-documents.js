'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        CREATE TABLE documents (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL CHECK (length(btrim(title)) > 0),
          edition text,
          source_url text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE document_chunks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          position integer NOT NULL CHECK (position >= 0),
          heading_path text[] NOT NULL DEFAULT '{}',
          page_start integer NOT NULL CHECK (page_start >= 1),
          page_end integer NOT NULL CHECK (page_end >= page_start),
          content text NOT NULL CHECK (length(btrim(content)) > 0),
          embedding vector(384) NOT NULL,
          CONSTRAINT document_chunks_document_position_unique UNIQUE (document_id, position)
        );
        CREATE INDEX documents_created_at_idx ON documents (created_at DESC, id DESC);
        CREATE INDEX document_chunks_embedding_idx
          ON document_chunks USING hnsw (embedding vector_cosine_ops);
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('DROP TABLE document_chunks; DROP TABLE documents;', { transaction });
    });
  },
};
