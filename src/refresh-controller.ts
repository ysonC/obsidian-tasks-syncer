export interface RefreshIdentity {
	provider: string;
	listId: string;
	showCompleted: boolean;
	generation: number;
}

export type RefreshResult<T> = { status: "committed"; value: T } | { status: "discarded" };

function sameIdentity(left: RefreshIdentity, right: RefreshIdentity): boolean {
	return left.provider === right.provider
		&& left.listId === right.listId
		&& left.showCompleted === right.showCompleted
		&& left.generation === right.generation;
}

/** Serializes refreshes and commits only responses for the current runtime identity. */
export class RefreshCoordinator<T> {
	private active?: { identity: RefreshIdentity; promise: Promise<RefreshResult<T>> };
	private queued?: {
		identity: RefreshIdentity;
		promise: Promise<RefreshResult<T>>;
		resolve: (result: RefreshResult<T>) => void;
		reject: (error: unknown) => void;
	};
	private disposed = false;

	constructor(
		private readonly identity: () => RefreshIdentity,
		private readonly fetch: (identity: RefreshIdentity) => Promise<T>,
		private readonly commit: (value: T, identity: RefreshIdentity) => void,
	) {}

	refresh(): Promise<RefreshResult<T>> {
		if (this.disposed) return Promise.resolve({ status: "discarded" });
		const snapshot = { ...this.identity() };
		if (!this.active) return this.start(snapshot);
		if (sameIdentity(this.active.identity, snapshot)) {
			this.discardQueued();
			return this.active.promise;
		}
		if (this.queued && sameIdentity(this.queued.identity, snapshot)) return this.queued.promise;
		this.discardQueued();
		let resolve!: (result: RefreshResult<T>) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<RefreshResult<T>>((done, fail) => { resolve = done; reject = fail; });
		this.queued = { identity: snapshot, promise, resolve, reject };
		return promise;
	}

	private start(snapshot: RefreshIdentity): Promise<RefreshResult<T>> {
		const work = Promise.resolve().then(() => this.fetch(snapshot)).then(value => {
			if (this.disposed || !sameIdentity(snapshot, this.identity())) return { status: "discarded" } as const;
			this.commit(value, snapshot);
			return { status: "committed", value } as const;
		});
		let promise!: Promise<RefreshResult<T>>;
		promise = work.then(
			result => { this.finish(promise); return result; },
			error => { this.finish(promise); throw error; },
		);
		this.active = { identity: snapshot, promise };
		return promise;
	}

	private finish(promise: Promise<RefreshResult<T>>): void {
		if (this.active?.promise !== promise) return;
		this.active = undefined;
		const queued = this.queued;
		this.queued = undefined;
		if (!queued) return;
		if (this.disposed || !sameIdentity(queued.identity, this.identity())) {
			queued.resolve({ status: "discarded" });
			return;
		}
		this.start(queued.identity).then(queued.resolve, queued.reject);
	}

	private discardQueued(): void {
		this.queued?.resolve({ status: "discarded" });
		this.queued = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.discardQueued();
	}
}
