import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Auth.js v5 (Credentials + JWT). The PrismaAdapter is wired even though
// Credentials never writes through it — it's there so a future OAuth
// provider can persist Account/Session rows without a config change.
// See ADR-0020.
export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    // 14-day sliding expiry. Auth.js refreshes the cookie on `auth()`
    // calls automatically; no custom rotation logic needed.
    strategy: "jwt",
    maxAge: 14 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Returns null for every failure mode. Per Auth.js v5 docs, only
      // `null` or a thrown CredentialsSignin propagates as a clean user
      // error; a generic `throw new Error(...)` would surface as an
      // internal failure. The login UI shows one message ("invalid email
      // or password, or email not verified") that doesn't reveal which
      // path was hit, which is what we want anyway.
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email).toLowerCase() },
        });
        if (!user || !user.passwordHash) return null;
        if (!user.emailVerified) return null;

        const isValid = await bcrypt.compare(
          String(credentials.password),
          user.passwordHash,
        );
        if (!isValid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
