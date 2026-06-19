import {
  LayoutDashboard,
  Building2,
  CalendarClock,
  Calculator,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  {
    href: "/",
    label: "Paneli",
    description: "Të hyrat dhe shpenzimet",
    icon: LayoutDashboard,
  },
  {
    href: "/properties",
    label: "Pronat",
    description: "Shtëpitë, dokumentat, borxhet",
    icon: Building2,
  },
  {
    href: "/reservations",
    label: "Rezervimet",
    description: "Rezervimet aktive dhe të skaduara",
    icon: CalendarClock,
  },
  {
    href: "/calculator",
    label: "Kalkulatori",
    description: "Kalkulatori i fitimit",
    icon: Calculator,
  },
  {
    href: "/offers",
    label: "Ofertat",
    description: "Ofertat e ngarkuara",
    icon: FileText,
  },
];
