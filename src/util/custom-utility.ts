// Utility type to ensure at least one of the specified keys is provided
export type AtLeastOne<T, K extends keyof T> = Partial<T> & { [P in K]: Required<Pick<T, P>> }[K];
