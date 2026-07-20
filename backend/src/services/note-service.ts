import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { MarketService } from "./market-service";

interface NoteRow {
  id: string;
  instrument_id: string | null;
  title: string;
  content: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  instrumentId: string | null;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export class NoteService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly market: MarketService
  ) {}

  create(userId: string, input: { title: string; content: string; tags: string[]; instrumentId: string | null }): Note {
    if (input.instrumentId !== null) this.market.getInstrument(input.instrumentId);
    const now = new Date().toISOString();
    const row: NoteRow = { id: crypto.randomUUID(), instrument_id: input.instrumentId, title: input.title.trim(), content: input.content, tags_json: JSON.stringify([...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]), created_at: now, updated_at: now };
    this.database.run(
      `INSERT INTO notes (id, user_id, instrument_id, title, content, tags_json, created_at, updated_at)
       VALUES ($id, $userId, $instrumentId, $title, $content, $tags, $createdAt, $updatedAt)`,
      { id: row.id, userId, instrumentId: row.instrument_id, title: row.title, content: row.content, tags: row.tags_json, createdAt: now, updatedAt: now }
    );
    return this.toNote(row);
  }

  list(userId: string): Note[] {
    return this.database.all<NoteRow>("SELECT id, instrument_id, title, content, tags_json, created_at, updated_at FROM notes WHERE user_id = $userId ORDER BY updated_at DESC", { userId }).map((row) => this.toNote(row));
  }

  update(userId: string, id: string, input: { title: string; content: string; tags: string[]; instrumentId: string | null }): Note {
    const existing = this.database.get<NoteRow>("SELECT id, instrument_id, title, content, tags_json, created_at, updated_at FROM notes WHERE id = $id AND user_id = $userId", { id, userId });
    if (existing === undefined) throw errors.notFound("笔记不存在");
    if (input.instrumentId !== null) this.market.getInstrument(input.instrumentId);
    const updatedAt = new Date().toISOString();
    const next: NoteRow = { ...existing, instrument_id: input.instrumentId, title: input.title.trim(), content: input.content, tags_json: JSON.stringify([...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]), updated_at: updatedAt };
    this.database.run("UPDATE notes SET instrument_id = $instrumentId, title = $title, content = $content, tags_json = $tags, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id, userId, instrumentId: next.instrument_id, title: next.title, content: next.content, tags: next.tags_json, updatedAt });
    return this.toNote(next);
  }

  delete(userId: string, id: string): void {
    const note = this.database.get<{ id: string }>("SELECT id FROM notes WHERE id = $id AND user_id = $userId", { id, userId });
    if (note === undefined) throw errors.notFound("笔记不存在");
    this.database.run("DELETE FROM notes WHERE id = $id AND user_id = $userId", { id, userId });
  }

  private toNote(row: NoteRow): Note {
    return { id: row.id, instrumentId: row.instrument_id, title: row.title, content: row.content, tags: JSON.parse(row.tags_json) as string[], createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
