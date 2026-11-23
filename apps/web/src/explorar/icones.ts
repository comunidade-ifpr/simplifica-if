/**
 * O ícone de cada tipo da base, o mesmo nas abas do Explorar e nos grupos da paleta de busca.
 */
import type { TipoResultado } from "@simplifica-if/contratos-app";
import {
  BookMarkedIcon,
  FileTextIcon,
  GraduationCapIcon,
  ListTreeIcon,
  type LucideIcon,
  MapPinIcon,
  ScaleIcon,
  TextQuoteIcon,
  UsersIcon,
} from "lucide-react";

export const ICONES_TIPO: Readonly<Record<TipoResultado, LucideIcon>> = {
  dispositivo: TextQuoteIcon,
  norma: ScaleIcon,
  curso: GraduationCapIcon,
  ppc: FileTextIcon,
  secao: ListTreeIcon,
  campus: MapPinIcon,
  cnct: BookMarkedIcon,
  consepe: UsersIcon,
};
