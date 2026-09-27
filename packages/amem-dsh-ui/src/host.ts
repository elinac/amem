/** Host half: no-op apply so Loader can mount the package that carries dsh.client. */
export const name = "amem-dsh-ui";

export function apply(): void {
  // Client Modules loads ./client separately; Host half intentionally empty.
}
