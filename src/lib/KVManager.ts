export interface KVListKeysOptions {
	prefix?: string;
	limit?: number;
	cursor?: string;
}

export interface KVListKeysResult {
	keys: string[];
	cursor: string | null;
	listComplete: boolean;
}

type SerializableValue = string | number | boolean | null | Record<string, unknown> | unknown[];

/**
 * Cloudflare Workers KV 核心管理工具。
 *
 * 仅依赖 Workers Runtime 原生 KVNamespace，不使用 Node.js 模块或外部依赖。
 */
export class KVManager {
	private readonly namespace: KVNamespace;

	/**
	 * 创建 KV 管理实例。
	 *
	 * @param namespace Cloudflare Workers KV 命名空间绑定实例。
	 */
	constructor(namespace: KVNamespace) {
		this.namespace = namespace;
	}

	/**
	 * 读取指定 key 的值，并自动尝试 JSON.parse。
	 *
	 * JSON 解析成功时返回解析后的类型；解析失败时返回原始字符串。
	 * 读取异常时会输出错误日志并返回 null。
	 *
	 * @param key 要读取的 KV key。
	 * @returns 解析后的值、原始字符串或 null。
	 */
	async get<T>(key: string): Promise<T | null> {
		try {
			const value = await this.namespace.get(key, 'text');

			if (value === null) {
				return null;
			}

			return this.parseValue<T>(value);
		} catch (error) {
			console.error('[KVManager] Failed to get key:', key, error);
			return null;
		}
	}

	/**
	 * 写入指定 key 的值。
	 *
	 * 对象和数组会自动 JSON.stringify；其他常见可序列化值会转换为字符串。
	 * 完整透传 Cloudflare KV 原生 expiration、expirationTtl 和 metadata 参数。
	 *
	 * @param key 要写入的 KV key。
	 * @param value 要写入的值。
	 * @param options Cloudflare KV 原生写入参数。
	 * @returns 写入成功返回 true，失败返回 false。
	 */
	async set<T extends SerializableValue>(key: string, value: T, options?: KVNamespacePutOptions): Promise<boolean> {
		try {
			await this.namespace.put(key, this.stringifyValue(value), options);
			return true;
		} catch (error) {
			console.error('[KVManager] Failed to set key:', key, error);
			return false;
		}
	}

	/**
	 * 删除指定 key。
	 *
	 * @param key 要删除的 KV key。
	 * @returns 删除成功返回 true，失败返回 false。
	 */
	async delete(key: string): Promise<boolean> {
		try {
			await this.namespace.delete(key);
			return true;
		} catch (error) {
			console.error('[KVManager] Failed to delete key:', key, error);
			return false;
		}
	}

	/**
	 * 同时读取指定 key 的值和 metadata，并分别提供泛型类型支持。
	 *
	 * value 会自动尝试 JSON.parse；解析失败时作为普通字符串返回。
	 * 读取异常时返回 { value: null, metadata: null }。
	 *
	 * @param key 要读取的 KV key。
	 * @returns 包含 value 和 metadata 的对象。
	 */
	async getWithMetadata<T, M>(key: string): Promise<{ value: T | null; metadata: M | null }> {
		try {
			const result = await this.namespace.getWithMetadata<M>(key, 'text');

			return {
				value: result.value === null ? null : this.parseValue<T>(result.value),
				metadata: result.metadata,
			};
		} catch (error) {
			console.error('[KVManager] Failed to get key with metadata:', key, error);
			return {
				value: null,
				metadata: null,
			};
		}
	}

	/**
	 * 分页列出 KV key 名称。
	 *
	 * 支持按 prefix 筛选、limit 限制数量和 cursor 翻页。
	 *
	 * @param options 列表查询参数。
	 * @returns key 名称列表、下一页 cursor 和是否已列完。
	 */
	async listKeys(options?: KVListKeysOptions): Promise<KVListKeysResult> {
		try {
			const result = await this.namespace.list({
				prefix: options?.prefix,
				limit: options?.limit,
				cursor: options?.cursor,
			});

			return {
				keys: result.keys.map((key) => key.name),
				cursor: 'cursor' in result ? result.cursor : null,
				listComplete: result.list_complete,
			};
		} catch (error) {
			console.error('[KVManager] Failed to list keys:', options, error);
			return {
				keys: [],
				cursor: null,
				listComplete: true,
			};
		}
	}

	private parseValue<T>(value: string): T {
		try {
			return JSON.parse(value) as T;
		} catch {
			return value as T;
		}
	}

	private stringifyValue(value: SerializableValue): string {
		if (typeof value === 'string') {
			return value;
		}

		if (typeof value === 'object') {
			return JSON.stringify(value);
		}

		return String(value);
	}
}
