import { NetworkServers } from "./NetworkServers";
import { AdminLightsail } from "./AdminLightsail";
import { admin, rows, type Row } from "../shared/api";
import { State, useData } from "../shared/ui";

export function Infrastructure({section = "servers"}: {section?: string}) {
    const servers = useData<Row>(section === "servers" ? admin("server/ddns/fetch") : "");
    const nodes = useData<Row[]>(section !== "servers" ? admin("server/manage/getNodes") : "");
    if (section === "server-lightsail") return <State {...nodes} retry={nodes.reload}><AdminLightsail nodes={rows(nodes.data)} /></State>;
    return <>
        <State {...servers} retry={servers.reload}>{servers.data && <NetworkServers data={servers.data} reload={servers.reload} />}</State>
    </>;
}
