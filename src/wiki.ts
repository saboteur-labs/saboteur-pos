import type Database from 'better-sqlite3';
import { findKnowledgeBySlug, getKnowledgeEntry } from './db/knowledge.js';

export function resolveWikiLinks(db: Database.Database, content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (match, ref: string) => {
    const trimmed = ref.trim();

    // Try by ID first
    const byId = getKnowledgeEntry(db, trimmed);
    if (byId?.title) return `[[${byId.title}]]`;

    // Try by title slug
    const bySlug = findKnowledgeBySlug(db, trimmed);
    if (bySlug?.title) return `[[${bySlug.title}]]`;

    return `[[broken: ${trimmed}]]`;
  });
}
