declare const chrome:
  | {
      storage?: {
        sync?: {
          get(defaults: Record<string, unknown>, callback: (items: Record<string, unknown>) => void): void;
          set(items: Record<string, unknown>, callback?: () => void): void;
        };
      };
      runtime?: {
        lastError?: { message?: string };
        openOptionsPage?: () => void;
      };
    }
  | undefined;

declare const module: { exports: unknown } | undefined;
