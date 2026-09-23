export {};

declare global {
  var perish: Readonly<{
    daemon: string;
    token: string;
  }> | undefined;
}
