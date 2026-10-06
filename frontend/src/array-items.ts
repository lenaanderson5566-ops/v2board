export function moveItem<T>(items: T[], from: number, to: number): T[] {
    const next = [...items];
    if (from < 0 || to < 0 || from >= next.length || to >= next.length)
        return next;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}
