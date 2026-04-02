import type { ComponentType, ReactNode } from "react";

/** A primary navigation item rendered in the sidebar. */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
}

/** An external link rendered in the sidebar footer. */
export interface ExternalLink {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
}

/** Node identity and customization surface. */
export interface NodeAppConfig {
  /** Display name shown in the sidebar header and metadata. */
  readonly name: string;

  /** Logo branding for the sidebar header. */
  readonly logo: {
    readonly src: string;
    readonly alt: string;
    readonly href: string;
  };

  /** Primary sidebar navigation items. */
  readonly navItems: readonly NavItem[];

  /** External links in sidebar footer (GitHub, Discord, etc.). */
  readonly externalLinks: readonly ExternalLink[];

  /** Extra sidebar content injected after nav items (e.g., ChatThreadsSidebarGroup). */
  readonly sidebarExtras?: ReactNode;
}
