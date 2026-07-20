// ==========================================================
// Realistic Pool Water Script (LSL)
// Put on a flat, semi-transparent prim shaped as the water surface.
// ==========================================================

// ---- CONFIG ----
float RIPPLE_SPEED   = 0.15;   // texture scroll speed (ripples)
float RIPPLE_SPIN    = 0.05;   // slow rotation for organic movement
integer USE_GLOW      = TRUE;   // sparkle/glint on surface
float GLOW_MIN        = 0.02;
float GLOW_MAX        = 0.12;

integer USE_AMBIENT_SOUND = TRUE;
string  AMBIENT_SOUND      = "water_ambient"; // sound name/UUID in prim inventory
float   AMBIENT_VOLUME     = 0.3;

integer USE_SPLASH   = TRUE;
string  SPLASH_SOUND  = "splash";              // sound name/UUID in prim inventory
float   SPLASH_VOLUME = 1.0;

integer USE_TOUCH_SPLASH   = TRUE;
string  TOUCH_SPLASH_SOUND  = "splash_small";   // sound name/UUID in prim inventory (falls back to SPLASH_SOUND if blank)
float   TOUCH_SPLASH_VOLUME = 0.4;

integer USE_SPARKLE_PARTICLES = TRUE;

// ---- INTERNAL ----
float glowPhase = 0.0;

startSparkles()
{
    llParticleSystem([
        PSYS_PART_FLAGS, PSYS_PART_EMISSIVE_MASK | PSYS_PART_INTERP_COLOR_MASK,
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_EXPLODE,
        PSYS_PART_START_COLOR, <1,1,1>,
        PSYS_PART_END_COLOR, <0.8,0.9,1>,
        PSYS_PART_START_ALPHA, 0.6,
        PSYS_PART_END_ALPHA, 0.0,
        PSYS_PART_START_SCALE, <0.03,0.03,0>,
        PSYS_PART_END_SCALE, <0.01,0.01,0>,
        PSYS_SRC_BURST_RATE, 0.3,
        PSYS_SRC_BURST_PART_COUNT, 3,
        PSYS_SRC_BURST_SPEED_MIN, 0.0,
        PSYS_SRC_BURST_SPEED_MAX, 0.05,
        PSYS_SRC_MAX_AGE, 0.0,
        PSYS_PART_MAX_AGE, 1.5,
        PSYS_SRC_ACCEL, <0,0,0>,
        PSYS_SRC_BURST_RADIUS, 2.0
    ]);
}

playSplash(vector pos)
{
    if (USE_SPLASH)
    {
        llTriggerSound(SPLASH_SOUND, SPLASH_VOLUME);
    }

    llParticleSystem([
        PSYS_PART_FLAGS, PSYS_PART_EMISSIVE_MASK | PSYS_PART_INTERP_COLOR_MASK | PSYS_PART_INTERP_SCALE_MASK,
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_EXPLODE,
        PSYS_PART_START_COLOR, <1,1,1>,
        PSYS_PART_END_COLOR, <0.8,0.9,1>,
        PSYS_PART_START_ALPHA, 0.9,
        PSYS_PART_END_ALPHA, 0.0,
        PSYS_PART_START_SCALE, <0.15,0.15,0>,
        PSYS_PART_END_SCALE, <0.4,0.4,0>,
        PSYS_SRC_BURST_PART_COUNT, 15,
        PSYS_SRC_BURST_SPEED_MIN, 0.5,
        PSYS_SRC_BURST_SPEED_MAX, 1.5,
        PSYS_SRC_ACCEL, <0,0,-1.0>,
        PSYS_PART_MAX_AGE, 1.0,
        PSYS_SRC_MAX_AGE, 0.2,
        PSYS_SRC_BURST_RADIUS, 0.3
    ]);

    llSetTimerEvent(0.3); // brief timer to restore ambient sparkle after splash burst
}

playSmallSplash(vector pos)
{
    if (USE_TOUCH_SPLASH)
    {
        string snd = TOUCH_SPLASH_SOUND;
        if (snd == "") snd = SPLASH_SOUND;
        llTriggerSound(snd, TOUCH_SPLASH_VOLUME);
    }

    llParticleSystem([
        PSYS_PART_FLAGS, PSYS_PART_EMISSIVE_MASK | PSYS_PART_INTERP_COLOR_MASK | PSYS_PART_INTERP_SCALE_MASK,
        PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_EXPLODE,
        PSYS_PART_START_COLOR, <1,1,1>,
        PSYS_PART_END_COLOR, <0.8,0.9,1>,
        PSYS_PART_START_ALPHA, 0.7,
        PSYS_PART_END_ALPHA, 0.0,
        PSYS_PART_START_SCALE, <0.06,0.06,0>,
        PSYS_PART_END_SCALE, <0.15,0.15,0>,
        PSYS_SRC_BURST_PART_COUNT, 5,
        PSYS_SRC_BURST_SPEED_MIN, 0.2,
        PSYS_SRC_BURST_SPEED_MAX, 0.5,
        PSYS_SRC_ACCEL, <0,0,-1.0>,
        PSYS_PART_MAX_AGE, 0.6,
        PSYS_SRC_MAX_AGE, 0.1,
        PSYS_SRC_BURST_RADIUS, 0.1
    ]);

    llSetTimerEvent(0.3); // restore ambient sparkle after burst
}

default
{
    state_entry()
    {
        // Ripple animation: scroll + rotate the water texture for constant subtle motion
        llSetTextureAnim(ANIM_ON | LOOP | SMOOTH | ROTATE,
            ALL_SIDES, 1, 1, 0.0, TWO_PI, RIPPLE_SPIN);

        if (USE_AMBIENT_SOUND)
        {
            llLoopSound(AMBIENT_SOUND, AMBIENT_VOLUME);
        }

        if (USE_SPARKLE_PARTICLES)
        {
            startSparkles();
        }

        if (USE_GLOW)
        {
            llSetTimerEvent(0.5); // drive glow shimmer
        }
    }

    timer()
    {
        // Restore ambient sparkles after a splash burst overwrote the particle system
        if (USE_SPARKLE_PARTICLES)
        {
            startSparkles();
        }

        if (USE_GLOW)
        {
            glowPhase += 0.3;
            float g = GLOW_MIN + (GLOW_MAX - GLOW_MIN) * (0.5 + 0.5 * llSin(glowPhase));
            llSetPrimitiveParams([PRIM_GLOW, ALL_SIDES, g]);
            llSetTimerEvent(0.5);
        }
        else
        {
            llSetTimerEvent(0.0);
        }
    }

    collision_start(integer num_detected)
    {
        if (llDetectedType(0) & AGENT)
        {
            playSplash(llDetectedPos(0));
        }
    }

    touch_start(integer num_detected)
    {
        playSmallSplash(llDetectedPos(0));
    }
}
