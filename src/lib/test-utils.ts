/** In-memory `Storage` for tests; `fail` makes reads or writes throw. */
export class MemoryStorage implements Storage {
	#data = new Map<string, string>();
	fail: { get?: boolean; set?: boolean } = {};

	get length(): number {
		return this.#data.size;
	}
	clear(): void {
		this.#data.clear();
	}
	getItem(key: string): string | null {
		if (this.fail.get) throw new Error('SecurityError');
		return this.#data.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.#data.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.#data.delete(key);
	}
	setItem(key: string, value: string): void {
		if (this.fail.set) throw new Error('QuotaExceededError');
		this.#data.set(key, value);
	}
}
