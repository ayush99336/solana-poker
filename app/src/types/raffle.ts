export type Raffle = {
  id: string;
  name: string;
  price: number;
  description: string;
  endDate: string;
  totalTickets: number;
  soldTickets: number[];
};

export type Purchase = {
  raffleId: string;
  raffleName: string;
  ticketNumber: number;
  purchasedAt: string;
};

export const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
};