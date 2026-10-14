import type { ReactNode } from "react";
export function SettingsHeading({icon,title,description}:{icon:ReactNode;title:string;description:string}) {
    return <header className="account-page-heading"><span className="account-page-icon" aria-hidden="true">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></header>;
}
