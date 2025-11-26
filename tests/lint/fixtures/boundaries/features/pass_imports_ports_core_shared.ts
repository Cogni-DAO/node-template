import { something } from "@/core/thing";
import type { Port } from "@/ports/some";
import { util } from "@/shared/util/index";

export default [something, util] as const;
