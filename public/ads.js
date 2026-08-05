// ---------------------------------------------------------------
// Adverts (Google AdSense)
//
// The AdSense loader is in the page <head> (index.html) — that handles
// site verification and Google "Auto ads" (Google places ads for you
// once you enable Auto ads in your AdSense dashboard).
//
// This file additionally fills our own ad placements (the .ad-slot
// boxes) IF you create Ad units in AdSense and paste their slot IDs into
// AD_SLOTS below. Until then those boxes stay hidden and only Auto ads
// (if enabled) appear.
// ---------------------------------------------------------------

const ADSENSE_CLIENT = "ca-pub-6022289335915022";

const AD_SLOTS = {
    // container data-ad name : AdSense ad-unit "slot" id (digits)
    "search-top": "",   // e.g. "1234567890"
    "find-top": ""
};


(function fillAdSlots() {

    if (!ADSENSE_CLIENT) return;

    document.querySelectorAll(".ad-slot").forEach(container => {

        const slotId = AD_SLOTS[container.dataset.ad] || "";

        // Only render a controlled ad unit if a slot id is configured.
        // (Without one AdSense can't serve, so we leave the box hidden
        //  and let Auto ads handle placement instead.)
        if (!slotId) return;

        const label = document.createElement("div");
        label.className = "ad-label";
        label.textContent = "Advertisement";

        const ins = document.createElement("ins");
        ins.className = "adsbygoogle";
        ins.style.display = "block";
        ins.setAttribute("data-ad-client", ADSENSE_CLIENT);
        ins.setAttribute("data-ad-slot", slotId);
        ins.setAttribute("data-ad-format", "auto");
        ins.setAttribute("data-full-width-responsive", "true");

        container.appendChild(label);
        container.appendChild(ins);

        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
            // library still loading; it will pick this up shortly
        }
    });
})();
