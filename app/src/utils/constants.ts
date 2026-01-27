import { Raffle } from "@/types/raffle";

export const mockRaffles: Raffle[] = [
  {
    id: "1",
    name: "MacBook Pro M4",
    price: 0.5,
    description: "Win a brand new MacBook Pro with M4 chip",
    endDate: "2026-02-15",
    totalTickets: 100,
    soldTickets: [12, 45, 78],
  },
  {
    id: "2",
    name: "Tesla Model 3",
    price: 2,
    description: "Your chance to drive away in a Tesla",
    endDate: "2026-03-01",
    totalTickets: 100,
    soldTickets: [1, 22, 33, 44, 55],
  },
];
