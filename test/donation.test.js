import test from "node:test";
import assert from "node:assert/strict";

import { donationLinkResponse, PAYPAL_DONATION_URL } from "../src/lib/support/donation.js";

test("donation link is fixed and opens in a new browser tab", () => {
  assert.equal(PAYPAL_DONATION_URL, "https://www.paypal.com/donate/?hosted_button_id=DCWZ75YLHLFYW");
  assert.deepEqual(donationLinkResponse(), {
    url: PAYPAL_DONATION_URL,
    openUrl: PAYPAL_DONATION_URL,
    window: "_blank"
  });
});
