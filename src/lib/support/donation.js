export const PAYPAL_DONATION_URL = "https://www.paypal.com/donate/?hosted_button_id=DCWZ75YLHLFYW";

export function donationLinkResponse() {
  return {
    url: PAYPAL_DONATION_URL,
    openUrl: PAYPAL_DONATION_URL,
    window: "_blank"
  };
}
