import { HttpError } from "./hono/httpError";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HttpError(401, {
      name: "Unauthorized",
      message: "Not authorized",
    });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new HttpError(401, {
      name: "Unauthorized",
      message: "Not authorized",
    });
  }
  return user;
}

export async function requireTrainer() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HttpError(403, { name: "FORBIDDEN", message: "Trainer role required." });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || user.role !== "TRAINER") {
    throw new HttpError(403, { name: "FORBIDDEN", message: "Trainer role required." });
  }
  return { id: user.id, email: user.email };
}
