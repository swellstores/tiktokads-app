type Row = Record<string, any>;

/** An order as track-order reads it: account, items.product and items.variant expanded */
export function storefrontOrder(overrides: Row = {}): Row {
  return {
    id: "6ad1c3e82607510012311d5b",
    number: "100362",
    date_created: "2026-10-16T06:27:52.856Z",
    currency: "usd",
    grand_total: 157.3,
    sub_total: 149,
    account_id: "6ad1c391cbd53b001211018f",
    cart_id: "6ad1c390ea3885001207ce94",
    account: {
      id: "6ad1c391cbd53b001211018f",
      email: "Tiktok-Spike+1@Example.com",
      phone: null,
      first_name: "Tik",
      last_name: "Spike",
    },
    billing: {
      first_name: "Tik",
      last_name: "Spike",
      city: "San Jose",
      state: "CA",
      zip: "95110-1234",
      country: "US",
      phone: "(213) 373-4253",
    },
    shipping: {},
    items: [
      {
        product_id: "6ac7e5ed7b27f000134af14f",
        product_name: "Agency Reporting Pack",
        quantity: 1,
        price: 149,
        variant: null,
        product: { id: "6ac7e5ed7b27f000134af14f", name: "Agency Reporting Pack", sku: "PACK-01" },
      },
    ],
    ...overrides,
  };
}
