import { completeTask, failedTask, skillGate, taskNotFound, toSkillError } from "@/lib/skills/routeHelpers";
import { runHreflang } from "@/lib/skills/hreflang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKILL_ID = "hreflang" as const;
const IP_LIMIT_PER_MIN = 6;

export async function POST(request: Request): Promise<Response> {
  const gate = await skillGate(request, SKILL_ID, IP_LIMIT_PER_MIN);
  if (gate instanceof Response) return gate;
  const { scope } = gate;

  try {
    const result = await runHreflang(scope.url);
    return Response.json(
      { task: completeTask(SKILL_ID, scope, result, 1) },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const { kind, message } = toSkillError(err);
    return Response.json(
      { task: failedTask(SKILL_ID, scope, kind, message) },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// Stateless skill — no persisted task to poll for, always 404.
export function GET(): Response {
  return taskNotFound();
}
