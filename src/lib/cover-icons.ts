/**
 * Iconos de portada (TAL-60: Lucide en vez de emojis) — Design System
 * (`design/design-system.md` § "Estilo 2026 → Iconos").
 *
 * El catálogo (nombres, categorías, términos de búsqueda en español), la
 * tabla de los emojis antiguos y la normalización viven en el fichero
 * neutral `convex/coverIconCatalog.ts`, porque Convex también los necesita
 * (validación y migración). Aquí solo se añade lo que Convex NO debe
 * arrastrar a su bundle: el componente de Lucide de cada nombre.
 *
 * Un import explícito por icono — nunca `import { icons } from "lucide-react"`,
 * que metería los ~1.800 iconos en el bundle del cliente del selector.
 * `satisfies Record<CoverIconName, LucideIcon>` hace que el compilador falle
 * si a algún nombre del catálogo le falta su componente.
 */
import {
  Baby,
  Balloon,
  Bell,
  Bird,
  BookHeart,
  Cake,
  CakeSlice,
  Camera,
  CandyCane,
  Cat,
  CloudSnow,
  Clover,
  Cookie,
  Disc3,
  Dog,
  Fish,
  Flame,
  Flower,
  Flower2,
  Gem,
  Gift,
  HandHeart,
  Heart,
  HeartHandshake,
  Mail,
  Martini,
  Moon,
  MoonStar,
  MountainSnow,
  Music,
  PartyPopper,
  PawPrint,
  Plane,
  Rabbit,
  Rainbow,
  Rose,
  Snowflake,
  Sparkles,
  Squirrel,
  Star,
  Sun,
  TreePine,
  Turtle,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { CoverIconName } from "../../convex/coverIconCatalog";

export {
  ALL_COVER_ICON_NAMES,
  COVER_ICON_CATEGORIES,
  DEFAULT_COVER_ICON,
  FALLBACK_COVER_ICON,
  LEGACY_EMOJI_TO_COVER_ICON,
  coverIconForWrite,
  isCoverIconName,
  isLegacyCoverEmoji,
  normalizeCoverIcon,
} from "../../convex/coverIconCatalog";
export type { CoverIconName } from "../../convex/coverIconCatalog";

export const COVER_ICON_COMPONENTS = {
  "tree-pine": TreePine,
  gift: Gift,
  snowflake: Snowflake,
  bell: Bell,
  "candy-cane": CandyCane,
  cookie: Cookie,
  flame: Flame,
  "cloud-snow": CloudSnow,
  "mountain-snow": MountainSnow,
  "party-popper": PartyPopper,
  balloon: Balloon,
  cake: Cake,
  "cake-slice": CakeSlice,
  wine: Wine,
  martini: Martini,
  music: Music,
  "disc-3": Disc3,
  camera: Camera,
  heart: Heart,
  "hand-heart": HandHeart,
  "heart-handshake": HeartHandshake,
  flower: Flower,
  rose: Rose,
  mail: Mail,
  "book-heart": BookHeart,
  gem: Gem,
  baby: Baby,
  star: Star,
  sparkles: Sparkles,
  sun: Sun,
  moon: Moon,
  "moon-star": MoonStar,
  rainbow: Rainbow,
  "flower-2": Flower2,
  clover: Clover,
  plane: Plane,
  rabbit: Rabbit,
  cat: Cat,
  dog: Dog,
  bird: Bird,
  fish: Fish,
  turtle: Turtle,
  squirrel: Squirrel,
  "paw-print": PawPrint,
} satisfies Record<CoverIconName, LucideIcon>;
