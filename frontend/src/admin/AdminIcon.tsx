import {
    Gauge, SlidersHorizontal, CreditCard, Layers, Wrench, Shuffle, ShoppingBag,
    List, Gift, Star, Users, MessageSquare, Headphones, Lightbulb, ChartColumn,
    RefreshCw, Shield, Settings, Ban, Smartphone, ChartLine, Image, Globe,
    LogIn, Notebook, Link, type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
    speedometer: Gauge, equalizer: SlidersHorizontal, "credit-card": CreditCard,
    layers: Layers, wrench: Wrench, shuffle: Shuffle, bag: ShoppingBag,
    list: List, present: Gift, star: Star, users: Users, speech: MessageSquare,
    support: Headphones, bulb: Lightbulb, "bar-chart": ChartColumn,
    refresh: RefreshCw, shield: Shield, settings: Settings, ban: Ban,
    "screen-smartphone": Smartphone, graph: ChartLine, picture: Image,
    globe: Globe, login: LogIn, notebook: Notebook, link: Link,
};

export function AdminIcon({ name, className }: { name: string; className?: string }) {
    const Icon = icons[name] || Gauge;
    return <Icon size={18} strokeWidth={1.75} className={className} aria-hidden="true" />;
}
