-- Discord events are on, for the staff server. Channel messages stay off for both communities until someone turns them on,
-- because DISCORD_MODE = "live" would otherwise post to the VIP channel through the webhook set in 0006.
UPDATE discord_dest SET transport = 'off';
