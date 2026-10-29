import type { Credentials } from "../lib/types";
let pending: Credentials | null | undefined;
const listeners = new Set<() => void>();
export function receiveConnection(value: Credentials | null) {
  pending = value;
  listeners.forEach(listener => listener());
}
export function takeConnection() {
  const value = pending;
  pending = undefined;
  return value;
}
export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
