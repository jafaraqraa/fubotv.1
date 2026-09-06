'use strict';

const crypto = require('crypto');
const { normalizeForRetrieval } = require('../normalization/arabic');

function tokens(text) { return String(text || '').trim().split(/\s+/u).filter(Boolean); }
function stableId(parts) { return crypto.createHash('sha256').update(parts.join('\0')).digest('hex'); }

function structuralBlocks(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = []; let headingPath = []; let buffer = [];
    const flush = () => { if (buffer.length) { blocks.push({ sectionPath: [...headingPath], text: buffer.join('\n').trim() }); buffer = []; } };
    for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match) { flush(); const level = match[1].length; headingPath = [...headingPath.slice(0, level - 1), match[2].trim()]; continue; }
        if (!trimmed) {
            // Paragraph boundaries are useful formatting, but they must not
            // separate a label from its value (prices, dates, conditions).
            if (buffer.length && buffer[buffer.length - 1] !== '') buffer.push('');
            continue;
        }
        buffer.push(line);
    }
    flush(); return blocks.filter(block => block.text);
}

function chunkDocument(input, config) {
    for (const key of ['tenantId', 'knowledgeBaseId', 'documentId', 'documentVersionId']) if (!input[key]) throw new Error(`${key} is required`);
    const max = config.childChunkTokens; const overlap = config.overlapTokens;
    const children = []; const seen = new Set();
    for (const block of structuralBlocks(input.originalText)) {
        const words = tokens(block.text);
        const parentId = stableId([input.documentVersionId, 'parent', block.sectionPath.join('/'), block.text]);
        for (let start = 0; start < words.length; start += Math.max(1, max - overlap)) {
            const slice = words.slice(start, start + max); if (!slice.length) break;
            const originalText = slice.join(' ');
            const retrievalText = normalizeForRetrieval(`${block.sectionPath.join(' > ')} ${originalText}`);
            const digest = stableId([input.documentVersionId, retrievalText]);
            if (!seen.has(digest)) {
                seen.add(digest);
                children.push({
                    chunkId: digest, parentId, tenantId: input.tenantId, knowledgeBaseId: input.knowledgeBaseId,
                    documentId: input.documentId, documentVersionId: input.documentVersionId,
                    versionNumber: input.versionNumber, status: input.status || 'active', isCurrent: input.isCurrent !== false,
                    permissions: [...(input.permissions || [])], title: input.title || input.sourceUri || input.documentId,
                    sourceUri: input.sourceUri || null, sectionPath: block.sectionPath, pageNumber: input.pageNumber ?? null,
                    language: input.language || 'und', originalText, retrievalText, tokenCount: slice.length,
                    contentChecksum: crypto.createHash('sha256').update(originalText).digest('hex')
                });
            }
            if (start + max >= words.length) break;
        }
    }
    return children;
}

module.exports = { structuralBlocks, chunkDocument };
