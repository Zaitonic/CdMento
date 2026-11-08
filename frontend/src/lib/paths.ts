export function safeNext(value: string | null) {
  return value &&
    /^\/(workspace|notebooks|sources|chat|notes|flashcards|quizzes|mindmaps|focus|profile)(?:[?#]|$)/.test(
      value,
    )
    ? value
    : "/workspace";
}
