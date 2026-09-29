import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { UserRole } from "@/lib/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
    };
  }
  interface User {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}

const USER_RESYNC_MS = 5 * 60 * 1000;
const lastUserResyncAt = new Map<string, number>();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as UserRole,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.email = user.email;
        token.name = user.name;
        return token;
      }

      // Re-sync after DB reseed / user recreation so stale JWT ids don't break ACL.
      // At most once per email per 5 minutes so navigation does not hit Postgres every time.
      const email = token.email ? String(token.email) : "";
      if (email) {
        const now = Date.now();
        const previous = lastUserResyncAt.get(email) ?? 0;
        if (now - previous >= USER_RESYNC_MS) {
          lastUserResyncAt.set(email, now);
          try {
            const dbUser = await prisma.user.findUnique({
              where: { email },
              select: { id: true, role: true, name: true, email: true },
            });
            if (dbUser) {
              token.id = dbUser.id;
              token.role = dbUser.role as UserRole;
              token.name = dbUser.name;
              token.email = dbUser.email;
            }
          } catch (error) {
            lastUserResyncAt.delete(email);
            console.error("jwt user re-sync failed", error);
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        if (token.email) session.user.email = String(token.email);
        if (token.name) session.user.name = String(token.name);
      }
      return session;
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});
