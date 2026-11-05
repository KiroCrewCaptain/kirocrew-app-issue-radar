/** `gitlabHostSet` from the dashboard's `utils/pullRequestLinks.ts`, restated: pure.
 *
 * Normalize the configured GitLab hosts to a lookup set. Entries are exact
 * `host[:port]` values from operator config (`dashboard.gitlab_hosts`). An explicit
 * `:443` is dropped to match the URL API (and the backend), which omits the default
 * HTTPS port. */
export function gitlabHostSet(hosts: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(
    (hosts ?? [])
      .map(host => host.trim().toLowerCase().replace(/:443$/, ''))
      .filter(Boolean),
  )
}
