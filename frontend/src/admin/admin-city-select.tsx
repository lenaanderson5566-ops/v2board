import { useId } from "react";
import locations from "../../../resources/client/node-locations.json";

export function AdminCitySelect({
    label,
    value,
    region,
    onChange,
}: {
    label: string;
    value: unknown;
    region: unknown;
    onChange: (value: string) => void;
}) {
    const id = useId();
    const code = String(value ?? "");
    const country = String(region ?? "").toUpperCase();
    const cities = Object.entries(locations.cities).filter(
        ([key]) =>
            !country ||
            locations.cityRegions[key as keyof typeof locations.cityRegions] ===
                country,
    );
    const names = locations.cities[code as keyof typeof locations.cities];
    return (
        <div className="admin-city-select">
            <input
                aria-label={label}
                list={id}
                autoComplete="off"
                placeholder="选择参考城市或输入英文城市名"
                value={names?.["zh-CN"] ?? code}
                onChange={(event) => {
                    const text = event.target.value;
                    const city = cities.find(([key, translations]) =>
                        [key, ...Object.values(translations)].some(
                            (name) =>
                                name.toLowerCase() ===
                                text.trim().toLowerCase(),
                        ),
                    );
                    onChange(city?.[0] ?? text);
                }}
            />
            <datalist id={id}>
                {cities.map(([key, names]) => (
                    <option
                        key={key}
                        value={names["zh-CN"]}
                        label={`${names["en-US"]} (${key})`}
                    />
                ))}
            </datalist>
            {!!code && !names && (
                <small className="muted">
                    未收录城市翻译，将使用英文名称；保存时自动规范化标识。
                </small>
            )}
        </div>
    );
}
