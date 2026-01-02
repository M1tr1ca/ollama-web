// Pet Game Application - Free Roaming Edition
class PetGame {
    constructor() {
        // Animation frames for each state
        this.animations = {
            walkRight: ['assets/andarDerecha/andarDerecha1.png', 'assets/andarDerecha/andarDerecha2.png', 'assets/andarDerecha/andarDerecha3.png', 'assets/andarDerecha/andarDerecha4.png'],
            walkLeft: ['assets/andarIzquierda/andarIzquierda1.png', 'assets/andarIzquierda/andarIzquierda2.png', 'assets/andarIzquierda/andarIzquierda3.png', 'assets/andarIzquierda/andarIzquierda4.png'],
            sleep: ['assets/dormir/Gemini_Generated_Image_up015rup015rup01.png'],
            yawn: ['assets/bostezar/gatoBostezando1.png', 'assets/bostezar/gatoBostezando2.png', 'assets/bostezar/gatoBostezando3.png', 'assets/bostezar/gatoBostezando4.png'],
            lick: ['assets/lamer/Lamer1.png', 'assets/lamer/Lamer2.png', 'assets/lamer/Lamer3.png', 'assets/lamer/Lamer4.png'],
            meow: ['assets/maullar/Maullar1.png', 'assets/maullar/Maullar2.png', 'assets/maullar/Maullar3.png', 'assets/maullar/Maullar4.png'],
            climbRight: ['assets/SubirParedDerecha/subirParedIzquierda1.png', 'assets/SubirParedDerecha/subirParedIzquierda2.png', 'assets/SubirParedDerecha/subirParedIzquierda3.png'],
            climbLeft: ['assets/SubirParedIzquierda/subirParedIzquierda1.png', 'assets/SubirParedIzquierda/subirParedIzquierda2.png', 'assets/SubirParedIzquierda/subirParedIzquierda3.png'],
            fallRight: ['assets/CaerMuroDerecha/cayendoMuroDerecha1.png', 'assets/CaerMuroDerecha/cayendoMuroDerecha2.png', 'assets/CaerMuroDerecha/cayendoMuroDerecha3.png', 'assets/CaerMuroDerecha/cayendoMuroDerecha4.png', 'assets/CaerMuroDerecha/cayendoMuroDerecha5.png', 'assets/CaerMuroDerecha/cayendoMuroDerecha6.png'],
            fallLeft: ['assets/CaerMuroIzquierda/cayendoMuroIzquierda1.png', 'assets/CaerMuroIzquierda/cayendoMuroIzquierda2.png', 'assets/CaerMuroIzquierda/cayendoMuroIzquierda3.png', 'assets/CaerMuroIzquierda/cayendoMuroIzquierda4.png', 'assets/CaerMuroIzquierda/cayendoMuroIzquierda5.png', 'assets/CaerMuroIzquierda/cayendoMuroIzquierda6.png']
        };

        // Pet stats
        this.stats = {
            happiness: 100,
            hunger: 100,
            energy: 100
        };

        // Pet position
        this.position = {
            x: 20, // percentage from left
            y: 60  // pixels from bottom (on the ground)
        };

        // Animation state
        this.currentAnimation = 'walkRight';
        this.currentFrame = 0;
        this.animationSpeed = 200; // ms per frame
        this.isAnimating = false;
        this.isSleeping = false;
        this.isMoving = false;

        // Touch interaction
        this.lastInteraction = Date.now();
        this.clickCount = 0;
        this.clickTimeout = null;

        // Track food state for room changes
        this.hadFood = true; // Start with food

        // DOM elements
        this.petContainer = document.getElementById('petContainer');
        this.petSprite = document.getElementById('petSprite');
        this.happinessBar = document.getElementById('happinessBar');
        this.hungerBar = document.getElementById('hungerBar');
        this.energyBar = document.getElementById('energyBar');
        this.statusMessage = document.getElementById('statusMessage');
        this.roomBackground = document.getElementById('roomBackground');
        this.foodButton = document.getElementById('foodButton');

        this.init();
    }

    init() {
        // Set responsive background
        this.setResponsiveBackground();
        window.addEventListener('resize', () => this.setResponsiveBackground());

        // Load saved state
        this.loadState();

        // Set initial position
        this.updatePosition();

        // Start with initial animation
        this.playAnimation('walkRight');

        // Update stats display
        this.updateStatsDisplay();

        // Set up event listeners
        this.setupEventListeners();

        // Start animation loop
        this.animate();

        // Start stat decay
        this.startStatDecay();

        // Start automatic behavior
        this.startAutoBehavior();
    }

    setResponsiveBackground() {
        const isMobile = window.innerWidth <= 768;
        const hasFood = this.stats.hunger >= 50; // If hunger is 50 or above, show room with food

        let bgImage;
        if (isMobile) {
            bgImage = hasFood ? 'assets/habitacion/movil.png' : 'assets/habitacion/movilSinComida.png';
        } else {
            bgImage = hasFood ? 'assets/habitacion/ordena.png' : 'assets/habitacion/ordernaSinComida.png';
        }

        this.roomBackground.style.backgroundImage = `url('${bgImage}')`;
    }

    setupEventListeners() {
        // Click/touch on pet for interactions
        this.petSprite.addEventListener('click', (e) => this.onPetClick(e));
        this.petSprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.onPetClick(e);
        });

        // Food button click
        this.foodButton.addEventListener('click', () => this.buyFood());
    }

    updatePosition() {
        // Update pet position on screen
        this.petContainer.style.left = `${this.position.x}%`;
        this.petContainer.style.bottom = `${this.position.y}px`; // Use pixels for ground level
        this.petContainer.style.transform = 'translate(-50%, 0)';

        // Force reflow to ensure transition works
        void this.petContainer.offsetWidth;
    }

    moveTo(x, y, callback = null) {
        if (this.isMoving || this.isSleeping) return;

        this.isMoving = true;
        const targetX = Math.max(5, Math.min(95, x));
        const targetY = Math.max(50, Math.min(80, y)); // Keep on ground level (pixels)

        // Determine direction
        const direction = targetX > this.position.x ? 'walkRight' : 'walkLeft';

        // Start walking animation
        this.playAnimation(direction);

        // Animate position
        this.position.x = targetX;
        this.position.y = targetY;
        this.updatePosition();

        // Stop walking after movement
        setTimeout(() => {
            this.isMoving = false;
            if (callback) callback();
        }, 800);
    }

    playAnimation(animationName, loop = true, callback = null) {
        if (this.isAnimating && !loop) return;

        this.currentAnimation = animationName;
        this.currentFrame = 0;
        this.isAnimating = true;

        const frames = this.animations[animationName];
        let frameCount = 0;

        const animateFrames = () => {
            if (!this.isAnimating) return;

            this.petSprite.src = frames[this.currentFrame];
            this.currentFrame = (this.currentFrame + 1) % frames.length;
            frameCount++;

            if (!loop && frameCount >= frames.length) {
                this.isAnimating = false;
                if (callback) callback();
            } else {
                setTimeout(animateFrames, this.animationSpeed);
            }
        };

        animateFrames();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
    }

    updateStatsDisplay() {
        // Update bars
        this.happinessBar.style.width = `${this.stats.happiness}%`;
        this.hungerBar.style.width = `${this.stats.hunger}%`;
        this.energyBar.style.width = `${this.stats.energy}%`;

        // Check if food state changed
        const hasFood = this.stats.hunger >= 50;
        if (this.hadFood && !hasFood) {
            // Food just disappeared
            this.showMessage('¡Se acabó la comida! 🍽️');
        } else if (!this.hadFood && hasFood) {
            // Food just appeared
            this.showMessage('¡Hay comida de nuevo! 🍖');
        }
        this.hadFood = hasFood;

        // Show/hide food button
        if (!hasFood) {
            this.foodButton.style.display = 'block';
        } else {
            this.foodButton.style.display = 'none';
        }

        // Update background based on hunger level
        this.setResponsiveBackground();

        // Save state
        this.saveState();
    }

    showMessage(message) {
        this.statusMessage.textContent = message;
        this.statusMessage.classList.add('show');

        setTimeout(() => {
            this.statusMessage.classList.remove('show');
        }, 2000);
    }

    onPetClick(e) {
        this.lastInteraction = Date.now();
        this.clickCount++;

        // Clear previous timeout
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
        }

        // Determine interaction based on click count
        this.clickTimeout = setTimeout(() => {
            if (this.clickCount === 1) {
                this.petInteraction();
            } else if (this.clickCount === 2) {
                this.feedInteraction();
            } else if (this.clickCount >= 3) {
                this.playInteraction();
            }
            this.clickCount = 0;
        }, 300);
    }

    petInteraction() {
        // Single click - pet the cat
        this.stats.happiness = Math.min(100, this.stats.happiness + 15);
        this.updateStatsDisplay();
        this.showMessage('¡Me encanta! 💕');

        this.playAnimation('lick', false, () => {
            this.playAnimation('walkRight');
        });
    }

    feedInteraction() {
        // Double click - feed the cat
        if (this.stats.hunger >= 95) {
            this.showMessage('¡No tengo hambre! 😸');
            this.playAnimation('meow', false, () => {
                this.playAnimation('walkRight');
            });
            return;
        }

        this.stats.hunger = Math.min(100, this.stats.hunger + 30);
        this.stats.happiness = Math.min(100, this.stats.happiness + 10);
        this.updateStatsDisplay();
        this.showMessage('¡Ñam ñam! 🍖');

        this.playAnimation('lick', false, () => {
            this.playAnimation('walkRight');
        });
    }

    buyFood() {
        // Buy food - adds 30 hunger points
        this.stats.hunger = Math.min(100, this.stats.hunger + 30);
        this.stats.happiness = Math.min(100, this.stats.happiness + 5);
        this.updateStatsDisplay();
        this.showMessage('¡Comida comprada! 🛒✨');

        // Cat celebrates
        this.playAnimation('meow', false, () => {
            this.playAnimation('walkRight');
        });
    }

    playInteraction() {
        // Triple click - play with cat
        if (this.stats.energy < 20) {
            this.showMessage('¡Estoy muy cansado! 😴');
            this.playAnimation('yawn', false, () => {
                this.playAnimation('sleep');
                this.isSleeping = true;
                setTimeout(() => {
                    this.isSleeping = false;
                    this.stats.energy = Math.min(100, this.stats.energy + 40);
                    this.updateStatsDisplay();
                    this.playAnimation('yawn', false, () => {
                        this.playAnimation('walkRight');
                    });
                }, 5000);
            });
            return;
        }

        this.stats.happiness = Math.min(100, this.stats.happiness + 25);
        this.stats.energy = Math.max(0, this.stats.energy - 15);
        this.updateStatsDisplay();
        this.showMessage('¡Qué divertido! 🎾');

        // Random playful animation
        const playAnimations = ['climbRight', 'fallRight', 'meow'];
        const randomAnim = playAnimations[Math.floor(Math.random() * playAnimations.length)];

        this.playAnimation(randomAnim, false, () => {
            this.playAnimation('walkRight');
        });
    }

    startStatDecay() {
        setInterval(() => {
            if (!this.isSleeping) {
                this.stats.hunger = Math.max(0, this.stats.hunger - 0.5);
                this.stats.energy = Math.max(0, this.stats.energy - 0.3);

                if (this.stats.hunger < 30 || this.stats.energy < 30) {
                    this.stats.happiness = Math.max(0, this.stats.happiness - 0.5);
                }

                this.updateStatsDisplay();

                // Auto-sleep if very tired
                if (this.stats.energy < 10 && !this.isSleeping && Math.random() < 0.3) {
                    this.autoSleep();
                }
            }
        }, 2000);
    }

    autoSleep() {
        this.isSleeping = true;
        this.showMessage('Zzz... 😴');

        this.playAnimation('yawn', false, () => {
            this.playAnimation('sleep');

            setTimeout(() => {
                this.isSleeping = false;
                this.stats.energy = Math.min(100, this.stats.energy + 50);
                this.updateStatsDisplay();
                this.showMessage('¡Buenos días! 😸');
                this.playAnimation('yawn', false, () => {
                    this.playAnimation('walkRight');
                });
            }, 8000);
        });
    }

    startAutoBehavior() {
        // Natural behavior - walk, meow, lick, yawn, etc.
        const performBehavior = () => {
            if (this.isSleeping || this.isMoving) {
                setTimeout(performBehavior, 2000);
                return;
            }

            // Random behavior selection - using only existing animations
            const behaviors = ['walk', 'meow', 'lick', 'yawn'];
            const randomBehavior = behaviors[Math.floor(Math.random() * behaviors.length)];

            switch (randomBehavior) {
                case 'walk':
                    // Walk to a random position within room boundaries (15% to 85%)
                    const targetX = Math.random() * 70 + 15; // 15-85% to stay within walls
                    const groundY = 60;
                    const direction = targetX > this.position.x ? 'walkRight' : 'walkLeft';

                    // Set moving flag
                    this.isMoving = true;

                    // Start walking animation
                    this.isAnimating = false; // Stop any current animation
                    setTimeout(() => {
                        this.playAnimation(direction, true);
                    }, 50);

                    // Update position with a small delay to ensure transition works
                    setTimeout(() => {
                        this.position.x = targetX;
                        this.position.y = groundY;
                        this.updatePosition();
                    }, 100);

                    // Stop walking animation after movement completes
                    setTimeout(() => {
                        this.isMoving = false;
                        this.isAnimating = false;
                        // After walking, do another behavior
                        setTimeout(performBehavior, 1000 + Math.random() * 2000);
                    }, 5500); // Slightly longer than CSS transition
                    break;

                case 'meow':
                    this.isAnimating = false;
                    setTimeout(() => {
                        this.playAnimation('meow', false, () => {
                            // After meowing, continue with next behavior
                            setTimeout(performBehavior, 1000 + Math.random() * 2000);
                        });
                    }, 50);
                    break;

                case 'lick':
                    this.isAnimating = false;
                    setTimeout(() => {
                        this.playAnimation('lick', false, () => {
                            // After licking, continue with next behavior
                            setTimeout(performBehavior, 1000 + Math.random() * 2000);
                        });
                    }, 50);
                    break;

                case 'yawn':
                    this.isAnimating = false;
                    setTimeout(() => {
                        this.playAnimation('yawn', false, () => {
                            // After yawning, continue with next behavior
                            setTimeout(performBehavior, 1000 + Math.random() * 2000);
                        });
                    }, 50);
                    break;
            }
        };

        // Start natural behavior after initial delay
        setTimeout(performBehavior, 2000);

        // Random behaviors
        setInterval(() => {
            if (!this.isAnimating && !this.isSleeping && !this.isMoving && Math.random() < 0.2) {
                const behaviors = ['meow', 'lick', 'yawn'];
                const randomBehavior = behaviors[Math.floor(Math.random() * behaviors.length)];

                this.playAnimation(randomBehavior, false, () => {
                    this.playAnimation('walkRight');
                });
            }
        }, 10000);
    }

    saveState() {
        const state = {
            stats: this.stats,
            position: this.position,
            timestamp: Date.now()
        };
        localStorage.setItem('petGameState', JSON.stringify(state));
    }

    loadState() {
        const savedState = localStorage.getItem('petGameState');
        if (savedState) {
            const state = JSON.parse(savedState);
            const timePassed = (Date.now() - state.timestamp) / 1000 / 60; // minutes

            // Decay stats based on time passed
            this.stats.hunger = Math.max(0, state.stats.hunger - (timePassed * 2));
            this.stats.energy = Math.max(0, state.stats.energy - (timePassed * 1.5));
            this.stats.happiness = Math.max(0, state.stats.happiness - (timePassed * 1));

            // Restore position
            if (state.position) {
                this.position = state.position;
            }

            this.updateStatsDisplay();
        }
    }
}

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PetGame();
});
