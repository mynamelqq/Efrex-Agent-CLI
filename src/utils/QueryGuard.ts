export class QueryGuard {
	private status: 'idle' | 'dispatching' | 'running' = 'idle';
	private generation = 0;
	private listeners = new Set<() => void>();

	reserve(): boolean {
		if (this.status !== 'idle') {
			return false;
		}
		this.status = 'dispatching';
		this.notify();
		return true;
	}

	cancelReservation(): void {
		if (this.status !== 'dispatching') {
			return;
		}
		this.status = 'idle';
		this.notify();
	}

	tryStart(): number | null {
		if (this.status === 'running') {
			return null;
		}
		this.status = 'running';
		this.generation += 1;
		this.notify();
		return this.generation;
	}

	end(generation: number): boolean {
		if (this.generation !== generation || this.status !== 'running') {
			return false;
		}
		this.status = 'idle';
		this.notify();
		return true;
	}

	forceEnd(): void {
		if (this.status === 'idle') {
			return;
		}
		this.status = 'idle';
		this.generation += 1;
		this.notify();
	}

	get isActive(): boolean {
		return this.status !== 'idle';
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): boolean => this.status !== 'idle';

	private notify(): void {
		this.listeners.forEach(listener => listener());
	}
}
