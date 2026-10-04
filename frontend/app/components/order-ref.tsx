"use client";

import Link from "next/link";
import { Capability } from "../lib/capabilities";
import { can, useAuth } from "./auth-provider";

/** "#123", linked to the order only for staff who can open orders (the kitchen and dispatch roles can't). */
export function OrderRef({ id }: { id: number }) {
  const { staff } = useAuth();
  return can(staff, Capability.ORDERS_MANAGE) ? <Link className="link" href={`/orders/${id}`}>#{id}</Link> : <span className="order-ref">#{id}</span>;
}
