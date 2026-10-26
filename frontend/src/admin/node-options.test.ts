import { expect, it } from "vitest";
import { anytlsPresets, paddingPreset } from "./anytls-padding";
import { nodeSettingsInitial, nodeSettingsPayload, nodeSettingsFields } from "./node-settings";
import { linkNode, nodeFields } from "./admin-linkage";
import { nodeDeploymentCommand, nodeUpgradeCommand } from "./node-deployment";
it("saves all AnyTLS presets as native arrays without the UI-only selector", () => {
    for (const preset of anytlsPresets) {
        const linked = linkNode("padding_preset",preset.id,{protocol:"anytls"});
        const saved = nodeSettingsPayload(linked);
        expect(saved.padding_scheme).toEqual(preset.scheme);
        expect(saved.padding_preset).toBeUndefined();
        expect(paddingPreset(saved.padding_scheme)).toBe(preset.id);
    }
});
it("preserves custom and serialized existing schemes", () => {
    const scheme=["stop=2","0=30-30","1=100-200"];
    const initial=nodeSettingsInitial({padding_scheme:JSON.stringify(scheme)});
    expect(initial.padding_preset).toBe("custom");
    expect(nodeSettingsPayload(initial).padding_scheme).toBe(JSON.stringify(scheme));
    const list=nodeSettingsFields([{key:"padding_scheme",label:"Padding"}]);
    expect(nodeFields("v2box",list,{protocol:"anytls",padding_preset:"light"}).map(f=>f.key)).toEqual(["padding_preset"]);
    expect(nodeFields("v2box",list,{protocol:"vless"})).toEqual([]);
});
it("keeps DDNS opt-in and quotes generated shell arguments", () => {
    const row={type:"v2box",install_command:"bash install.sh"};
    expect(nodeDeploymentCommand(row)).toBe(row.install_command);
    expect(nodeDeploymentCommand({...row,ddns:true,ddns_domain:"node.example.com",ddns_family:"dual"})).toBe("bash install.sh --ddns --ddns-domain 'node.example.com' --ddns-family dual");
    expect(nodeDeploymentCommand({...row,ddns:true,ddns_domain:"a'b"})).toContain("'a'\\''b'");
    expect(nodeDeploymentCommand({...row,type:"v2node",ddns:true})).toContain("python3 node-network.py configure");
});

it("uses versioned network helpers included in the released backend", () => {
 for(const command of [nodeDeploymentCommand({type:"v2node",install_command:"install",ddns:true})]) {
  expect(command).toContain("/v2box/v1.0.13/script/node-network.py");
  expect(command).not.toContain("/v2box/main/");
 }
});

it("uses the short server-provided upgrade command", () => {
 const command="wget --https-only -O install-v2box.sh 'https://panel.example/api/v10/public/node-deployment/bootstrap' && sh install-v2box.sh --install v1.0.13";
 expect(nodeUpgradeCommand({upgrade_command:command})).toBe(command);
 expect(nodeUpgradeCommand({})).toBe("");
});
