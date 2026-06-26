// Priority queue: gifts=1, follows=2, comments=3 (lower = higher priority)
export class PriorityQueue {
  constructor() {
    this._items = [];
  }

  enqueue(item, priority) {
    this._items.push({ item, priority });
    this._items.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this._items.shift()?.item ?? null;
  }

  get size() {
    return this._items.length;
  }

  clear() {
    this._items = [];
  }
}
