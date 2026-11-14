// Trecho de `apps/server/src/provider/Drivers/AntigravitySkills.ts` do T3 Code (a6d9140972): só as duas
// funções que `antigravityAuthSupport.ts` usa. A descoberta de skills (`discoverAntigravitySkills`, com o
// `yaml`) ficou de fora. Texto igual.
import * as Path from "effect/Path";

/** Match Python os.path.expanduser: USERPROFILE, then HOMEDRIVE+HOMEPATH on Windows; HOME elsewhere. */
export function resolveAntigravityUserHome(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  home: string,
): string {
  if (platform === "win32") {
    if (environment.USERPROFILE) return environment.USERPROFILE;
    if (environment.HOMEDRIVE && environment.HOMEPATH) {
      return `${environment.HOMEDRIVE}${environment.HOMEPATH}`;
    }
    return home;
  }
  return environment.HOME || home;
}

/** Link private GEMINI_HOME skills to ~/.gemini; ~/.agents/skills is ignored because .agents/skills is project-only. */
export function antigravityUserSkillDirectories(
  path: Path.Path,
  geminiHome: string,
): readonly [configSkills: string, cliSkills: string] {
  return [
    path.join(geminiHome, "config", "skills"),
    path.join(geminiHome, "antigravity-cli", "skills"),
  ];
}
