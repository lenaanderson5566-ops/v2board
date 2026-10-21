import { expect, it } from "vitest";
import { anytlsPresets, paddingPreset } from "./anytls-padding";
import { nodeSettingsInitial, nodeSettingsPayload, nodeSettingsFields } from "./node-settings";
import { linkNode, nodeFields } from "./admin-linkage";
import { nodeDeploymentCommand, nodeIPCommand, nodeReportCommand, nodeUpgradeCommand } from "./node-deployment";
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
 for(const command of [nodeIPCommand,nodeReportCommand("dual"),nodeDeploymentCommand({type:"v2node",install_command:"install",ddns:true})]) {
  expect(command).toContain("/v2box/v1.0.2/script/node-network.py");
  expect(command).not.toContain("/v2box/main/");
 }
});

it("prepares curl and all installer dependencies before the upgrade download", () => {
 expect(nodeUpgradeCommand).toContain("apt-get install -y -qq ca-certificates curl bash jq unzip coreutils");
 expect(nodeUpgradeCommand).toContain("apk add --no-cache");
 expect(nodeUpgradeCommand).toContain("dnf install -y");
 expect(nodeUpgradeCommand).toContain("yum install -y");
 expect(nodeUpgradeCommand.indexOf("apt-get install")).toBeLessThan(nodeUpgradeCommand.indexOf("curl -fSL"));
 expect(nodeUpgradeCommand).toContain(") && curl -fSL");
});
