import { ContentComposer } from "./ContentComposer";
import type { Row } from "./api";
export function AdminMailComposer({
    confirmed,
    onSave,
}: {
    confirmed: boolean;
    onSave: (body: Row) => Promise<void>;
}) {
    return (
        <ContentComposer kind="mail" confirmed={confirmed} onSave={onSave} />
    );
}
