# Auth Debug Report: Double SIWE Signature Investigation

## 1) Repro steps + environment

- **Command:** `pnpm dev:stack` (Dockerized infra + local Next.js)
- **Browser:** Chrome (User to confirm)
- **Wallet:** MetaMask (User to confirm version)
- **HMR:** Enabled (User confirmed "Fast Refresh" in logs). _Action: User to confirm if it happens with `next build && next start`._

## 2) Provider tree (MOST IMPORTANT)

### `src/app/providers/app-providers.client.tsx`

```tsx
import { WalletProvider } from "./wallet.client";
// ...
export function AppProviders({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <AuthProvider>
      <QueryProvider>
        <WalletProvider>{children}</WalletProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
```

### `src/app/providers/wallet.client.tsx`

```tsx
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { RainbowKitSiweNextAuthProvider } from "@rainbow-me/rainbowkit-siwe-next-auth";
import { WagmiProvider } from "wagmi";
import { config } from "@/shared/web3/wagmi";

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  const { resolvedTheme } = useTheme();
          {
            injected: () => connectorsLib.injected(),
            walletConnect: (opts) => connectorsLib.walletConnect(opts),
          }
        );

      const wagmiConfig = createConfig({
        chains,
        transports,
        connectors,
        ssr: false,
      });

      setConfig(wagmiConfig);
    }

    void initWagmiConfig();
  }, []);

  if (!config) {
    return null;
  }

  const rainbowKitTheme =
    resolvedTheme === "dark" ? createAppDarkTheme() : createAppLightTheme();

  return (
    <WagmiProvider config={config}>
      <RainbowKitSiweNextAuthProvider
        getSiweMessageOptions={() => ({
          statement: "Sign in with Ethereum to the app.",
        })}
      >
        <RainbowKitProvider theme={rainbowKitTheme}>
          {children}
        </RainbowKitProvider>
      </RainbowKitSiweNextAuthProvider>
    </WagmiProvider>
  );
}
```

**Nesting Order:**

1. WagmiProvider
2. RainbowKitSiweNextAuthProvider
3. RainbowKitProvider

**Confirmation:**

- [ ] Confirmed exactly ONE of each in runtime tree.

## 3) Singleton proof: wagmi config + QueryClient

### Wagmi Config Creation

```tsx
// Inside WalletProvider component
const [config, setConfig] = useState<Config | null>(null);

useEffect(() => {
  // ...
  const wagmiConfig = createConfig({
    chains,
    transports,
    connectors,
    ssr: false,
  });

  setConfig(wagmiConfig);
  // ...
}, []);
```

### QueryClient Creation

```tsx
// src/app/providers/query.client.tsx
export function QueryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 60 seconds
            staleTime: 60_000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Analysis:**

- [x] Config identity stability: Created inside `useEffect`, stored in state. Stable after mount.
- [x] QueryClient identity stability: Created via `useState` initializer. Stable across renders.

## 4) SIWE/NextAuth boundary code

### `src/auth.ts` (Authorize)

```typescript
      async authorize(credentials, req) {
        try {
          if (!credentials?.message || !credentials?.signature) {
            console.error("[SIWE] Missing credentials");
            return null;
          }

          const siwe = new SiweMessage(credentials.message as string);
          // ...
          // Verify domain, nonce, and signature
          const nonce = await getCsrfToken({ req: { headers } });
          // ...
          const result = await siwe.verify({
            signature: credentials.signature as string,
            domain: nextAuthUrl.host,
            nonce,
          });
          // ...
          // Check for existing user
          let user = await db.query.users.findFirst({
            where: eq(users.walletAddress, fields.address),
          });
          // ...
          return {
            id: user.id,
            walletAddress: user.walletAddress,
          };
        } catch (e) {
          console.error("[SIWE] Authorize error:", e);
          return null;
        }
      },
```

### NextAuth Callbacks

```typescript
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.walletAddress = user.walletAddress ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.walletAddress = token.walletAddress as string | null;
      }
      return session;
    },
  },
```

## 5) Client-side SIWE instrumentation

**Logs to capture:**

- `[SIWE-DEBUG] Signature prompt initiated: nonce=...`
- `[SIWE-DEBUG] Sign-in callback fired`

**Implementation:**

- [ ] Added instrumentation to `WalletProvider` or `WalletConnectButton`.

## 6) MetaMask message comparison

**Prompt #1:**

```text
(User to paste)
```

**Prompt #2:**

```text
(User to paste)
```

**Nonce Comparison:**

- [ ] Identical?
- [ ] Different?

## 7) Network + server log trace (single attempt)

**Client Network (HAR/Requests):**

- (User to paste)

**Server Logs:**

- (User to paste)
