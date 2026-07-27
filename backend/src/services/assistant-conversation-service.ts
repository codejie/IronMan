import { IronManDatabase } from "../db/database";
import { errors } from "../errors";

export type AssistantConversationRole = "user" | "assistant";

export interface AssistantConversationMessage<TMetadata = unknown> {
  id: string;
  role: AssistantConversationRole;
  content: string;
  result?: TMetadata;
  createdAt: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantConversationDetail<TMetadata = unknown> extends AssistantConversationSummary {
  messages: AssistantConversationMessage<TMetadata>[];
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
}

interface MessageRow {
  id: string;
  role: AssistantConversationRole;
  content: string;
  result_json: string | null;
  created_at: string;
}

const recentConversationLimit = 30;

export class AssistantConversationService {
  constructor(private readonly database: IronManDatabase) {}

  create<TMetadata = unknown>(userId: string): AssistantConversationDetail<TMetadata> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.database.run(
      `INSERT INTO assistant_conversations (id, user_id, title, created_at, updated_at)
       VALUES ($id, $userId, $title, $createdAt, $updatedAt)`,
      { id, userId, title: "新对话", createdAt: now, updatedAt: now }
    );
    return this.get<TMetadata>(userId, id);
  }

  list(userId: string): AssistantConversationSummary[] {
    return this.database.all<ConversationRow>(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
        (
          SELECT m.content
          FROM assistant_messages AS m
          WHERE m.conversation_id = c.id AND m.user_id = c.user_id
          ORDER BY m.created_at DESC, m.rowid DESC
          LIMIT 1
        ) AS last_message_preview
       FROM assistant_conversations AS c
       WHERE c.user_id = $userId
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $limit`,
      { userId, limit: recentConversationLimit }
    ).map((row) => this.toSummary(row));
  }

  get<TMetadata = unknown>(userId: string, id: string): AssistantConversationDetail<TMetadata> {
    const conversation = this.getSummaryRow(userId, id);
    const messages = this.database.all<MessageRow>(
      `SELECT id, role, content, result_json, created_at
       FROM assistant_messages
       WHERE user_id = $userId AND conversation_id = $conversationId
       ORDER BY created_at ASC, rowid ASC`,
      { userId, conversationId: id }
    ).map((row) => this.toMessage<TMetadata>(row));
    return { ...this.toSummary(conversation), messages };
  }

  getSummary(userId: string, id: string): AssistantConversationSummary {
    return this.toSummary(this.getSummaryRow(userId, id));
  }

  delete(userId: string, id: string): { deleted: true } {
    this.getSummaryRow(userId, id);
    this.database.transaction(() => {
      this.database.run(
        "DELETE FROM assistant_conversations WHERE id = $id AND user_id = $userId",
        { id, userId }
      );
    });
    return { deleted: true };
  }

  getContext(userId: string, conversationId: string, limit: number): Array<Pick<AssistantConversationMessage, "role" | "content">> {
    this.getSummaryRow(userId, conversationId);
    const rows = this.database.all<Pick<MessageRow, "role" | "content">>(
      `SELECT role, content
       FROM (
         SELECT role, content, created_at, rowid AS message_sequence
         FROM assistant_messages
         WHERE user_id = $userId AND conversation_id = $conversationId
         ORDER BY created_at DESC, rowid DESC
         LIMIT $limit
       )
       ORDER BY created_at ASC, message_sequence ASC`,
      { userId, conversationId, limit }
    );
    return rows.map((row) => ({ role: row.role, content: row.content }));
  }

  appendUser<TMetadata = unknown>(userId: string, conversationId: string, content: string): AssistantConversationMessage<TMetadata> {
    const conversation = this.getSummaryRow(userId, conversationId);
    const message = this.insertMessage<TMetadata>(userId, conversationId, "user", content);
    const title = conversation.title === "新对话" ? conversationTitle(content) : conversation.title;
    this.touch(userId, conversationId, title);
    return message;
  }

  appendAssistant<TMetadata>(userId: string, conversationId: string, content: string, result: TMetadata): AssistantConversationMessage<TMetadata> {
    this.getSummaryRow(userId, conversationId);
    const message = this.insertMessage(userId, conversationId, "assistant", content, result);
    this.touch(userId, conversationId);
    return message;
  }

  private getSummaryRow(userId: string, id: string): ConversationRow {
    const row = this.database.get<ConversationRow>(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
        (
          SELECT m.content
          FROM assistant_messages AS m
          WHERE m.conversation_id = c.id AND m.user_id = c.user_id
          ORDER BY m.created_at DESC, m.rowid DESC
          LIMIT 1
        ) AS last_message_preview
       FROM assistant_conversations AS c
       WHERE c.id = $id AND c.user_id = $userId`,
      { id, userId }
    );
    if (row === undefined) throw errors.notFound("AI 会话不存在");
    return row;
  }

  private insertMessage<TMetadata>(
    userId: string,
    conversationId: string,
    role: AssistantConversationRole,
    content: string,
    result?: TMetadata
  ): AssistantConversationMessage<TMetadata> {
    const message: AssistantConversationMessage<TMetadata> = {
      id: crypto.randomUUID(),
      role,
      content,
      ...(result === undefined ? {} : { result }),
      createdAt: new Date().toISOString()
    };
    this.database.run(
      `INSERT INTO assistant_messages (id, user_id, conversation_id, role, content, result_json, created_at)
       VALUES ($id, $userId, $conversationId, $role, $content, $resultJson, $createdAt)`,
      {
        id: message.id,
        userId,
        conversationId,
        role,
        content,
        resultJson: result === undefined ? null : JSON.stringify(result),
        createdAt: message.createdAt
      }
    );
    return message;
  }

  private touch(userId: string, conversationId: string, title?: string): void {
    const updatedAt = new Date().toISOString();
    this.database.run(
      `UPDATE assistant_conversations
       SET title = COALESCE($title, title), updated_at = $updatedAt
       WHERE id = $id AND user_id = $userId`,
      { id: conversationId, userId, title: title ?? null, updatedAt }
    );
  }

  private toSummary(row: ConversationRow): AssistantConversationSummary {
    return {
      id: row.id,
      title: row.title,
      lastMessagePreview: row.last_message_preview === null ? null : preview(row.last_message_preview),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toMessage<TMetadata>(row: MessageRow): AssistantConversationMessage<TMetadata> {
    const result = row.result_json === null ? undefined : parseMetadata<TMetadata>(row.result_json);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      ...(result === undefined ? {} : { result }),
      createdAt: row.created_at
    };
  }
}

function conversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= 48 ? normalized || "新对话" : `${normalized.slice(0, 48)}…`;
}

function preview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 72)}…`;
}

function parseMetadata<TMetadata>(value: string): TMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as TMetadata : undefined;
  } catch {
    return undefined;
  }
}
