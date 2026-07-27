const crypto = require('crypto');
const { normalizeArabic } = require('./arabicNormalizer');

/**
 * Validates chunk size and overlap parameters.
 */
function validateChunkParams(chunkSize, chunkOverlap) {
    const size = parseInt(chunkSize, 10);
    const overlap = parseInt(chunkOverlap, 10);

    if (isNaN(size) || size < 200 || size > 4000) {
        throw new Error('حجم المقطع غير صالح. يجب أن يكون بين 200 و 4000 حرف.');
    }
    if (isNaN(overlap) || overlap < 0 || overlap > 1000) {
        throw new Error('تداخل المقاطع غير صالح. يجب أن يكون بين 0 و 1000 حرف.');
    }
    if (overlap >= size) {
        throw new Error('يجب أن يكون تداخل المقاطع أصغر من حجم المقطع نفسه.');
    }
}

/**
 * Splits text into atomic structural units (paragraphs, lists, sentences, words, characters)
 */
function splitIntoStructuralUnits(text, maxUnitSize) {
    // 1. Try splitting by paragraph (double newlines)
    const paragraphs = text.split('\n\n').map(p => p.trim()).filter(Boolean);
    const units = [];

    for (const paragraph of paragraphs) {
        if (paragraph.length <= maxUnitSize) {
            units.push(paragraph);
        } else {
            // 2. If a paragraph is too large, split by sentence or Q&A lines
            const sentences = paragraph.split(/(?<=[.!?؟])\s+/).map(s => s.trim()).filter(Boolean);
            for (const sentence of sentences) {
                if (sentence.length <= maxUnitSize) {
                    units.push(sentence);
                } else {
                    // 3. If a sentence is too large, split by spaces (words)
                    const words = sentence.split(/\s+/).filter(Boolean);
                    let currentWordBlock = '';
                    for (const word of words) {
                        if ((currentWordBlock + ' ' + word).trim().length <= maxUnitSize) {
                            currentWordBlock = (currentWordBlock + ' ' + word).trim();
                        } else {
                            if (currentWordBlock) units.push(currentWordBlock);
                            currentWordBlock = word;
                            // If a single word is larger than maxUnitSize (rare), force split characters
                            if (currentWordBlock.length > maxUnitSize) {
                                for (let i = 0; i < currentWordBlock.length; i += maxUnitSize) {
                                    units.push(currentWordBlock.substring(i, i + maxUnitSize));
                                }
                                currentWordBlock = '';
                            }
                        }
                    }
                    if (currentWordBlock) {
                        units.push(currentWordBlock);
                    }
                }
            }
        }
    }
    return units;
}

/**
 * Generates chunks from structural units with overlap and links previous/next.
 * Chunk size is measured in Unicode characters, not exact model tokens.
 */
function chunkDocument(document, chunkSize = 800, chunkOverlap = 120) {
    validateChunkParams(chunkSize, chunkOverlap);

    const { documentId, source, sourceType, originalText, documentHash } = document;
    const units = splitIntoStructuralUnits(originalText, chunkSize);

    const chunks = [];
    let currentChunkText = '';

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];

        if (currentChunkText && (currentChunkText + '\n\n' + unit).length > chunkSize) {
            chunks.push(currentChunkText);

            // Build the next chunk starting with overlap from the current chunk
            let overlapText = '';
            if (chunkOverlap > 0 && currentChunkText.length > chunkOverlap) {
                const sliceStart = currentChunkText.length - chunkOverlap;
                const rawSlice = currentChunkText.substring(sliceStart);
                // Align to word boundary to prevent word splitting
                const firstSpaceIndex = rawSlice.indexOf(' ');
                if (firstSpaceIndex !== -1 && firstSpaceIndex < rawSlice.length - 1) {
                    overlapText = rawSlice.substring(firstSpaceIndex + 1);
                } else {
                    overlapText = rawSlice;
                }
            }

            currentChunkText = overlapText ? (overlapText + '\n\n' + unit) : unit;
        } else {
            currentChunkText = currentChunkText ? (currentChunkText + '\n\n' + unit) : unit;
        }
    }

    if (currentChunkText) {
        chunks.push(currentChunkText);
    }

    // Map to final Rich Chunk model with metadata and linkage
    const richChunks = chunks.map((text, index) => {
        const normalizedText = normalizeArabic(text);
        const contentHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');

        // Deterministic stable chunk ID based on documentId, index, and contentHash
        const chunkId = `${documentId}_chunk_${index}_${contentHash.substring(0, 12)}`;

        return {
            chunkId,
            documentId,
            source,
            sourceType,
            chunkIndex: index,
            totalChunks: chunks.length,
            text,
            normalizedText,
            contentHash,
            documentHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: new Date().toISOString(),
            language: 'ar',
            chunkSize,
            chunkOverlap,
            previousChunkId: null,
            nextChunkId: null
        };
    });

    // Populate linked-list links
    for (let i = 0; i < richChunks.length; i++) {
        if (i > 0) {
            richChunks[i].previousChunkId = richChunks[i - 1].chunkId;
        }
        if (i < richChunks.length - 1) {
            richChunks[i].nextChunkId = richChunks[i + 1].chunkId;
        }
    }

    return richChunks;
}

module.exports = {
    validateChunkParams,
    chunkDocument
};
