import type { NodeAppConfig } from "@cogni/node-app/extensions";
import {
  Briefcase,
  CreditCard,
  Github,
  LayoutDashboard,
  Vote,
} from "lucide-react";

export const nodeConfig: NodeAppConfig = {
  name: "Cogni",
  logo: { src: "/TransparentBrainOnly.png", alt: "Cogni", href: "/chat" },
  navItems: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/work", label: "Work", icon: Briefcase },
    { href: "/gov", label: "Gov", icon: Vote },
    { href: "/credits", label: "Credits", icon: CreditCard },
  ],
  externalLinks: [
    {
      href: "https://github.com/cogni-dao/node-template",
      label: "GitHub",
      icon: Github,
    },
  ],
};
