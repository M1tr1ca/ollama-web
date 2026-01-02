// Pet Cat - Simplified for Chat Integration with Toggle Support
// Singleton pattern to prevent duplicates

let petCatInstance = null;
let petToggleInitialized = false;

class PetCat {
    constructor() {
        // Prevent duplicates - remove any existing pet first
        this.removeExistingPets();

        // Animation frames for each state
        this.animations = {
            walkRight: ['assets/cat/animaciones/andarDerecha/andarDerecha1.png', 'assets/cat/animaciones/andarDerecha/andarDerecha2.png', 'assets/cat/animaciones/andarDerecha/andarDerecha3.png', 'assets/cat/animaciones/andarDerecha/andarDerecha4.png'],
            walkLeft: ['assets/cat/animaciones/andarIzquierda/andarIzquierda1.png', 'assets/cat/animaciones/andarIzquierda/andarIzquierda2.png', 'assets/cat/animaciones/andarIzquierda/andarIzquierda3.png', 'assets/cat/animaciones/andarIzquierda/andarIzquierda4.png'],
            sleep: ['assets/cat/animaciones/dormir/Gemini_Generated_Image_up015rup015rup01.png'],
            yawn: ['assets/cat/animaciones/bostezar/gatoBostezando1.png', 'assets/cat/animaciones/bostezar/gatoBostezando2.png', 'assets/cat/animaciones/bostezar/gatoBostezando3.png', 'assets/cat/animaciones/bostezar/gatoBostezando4.png'],
            lick: ['assets/cat/animaciones/lamer/Lamer1.png', 'assets/cat/animaciones/lamer/Lamer2.png', 'assets/cat/animaciones/lamer/Lamer3.png', 'assets/cat/animaciones/lamer/Lamer4.png'],
            meow: ['assets/cat/animaciones/maullar/Maullar1.png', 'assets/cat/animaciones/maullar/Maullar2.png', 'assets/cat/animaciones/maullar/Maullar3.png', 'assets/cat/animaciones/maullar/Maullar4.png'],
            climbRight: ['assets/cat/animaciones/SubirParedDerecha/subirParedIzquierda1.png', 'assets/cat/animaciones/SubirParedDerecha/subirParedIzquierda2.png', 'assets/cat/animaciones/SubirParedDerecha/subirParedIzquierda3.png'],
            climbLeft: ['assets/cat/animaciones/SubirParedIzquierda/subirParedIzquierda1.png', 'assets/cat/animaciones/SubirParedIzquierda/subirParedIzquierda2.png', 'assets/cat/animaciones/SubirParedIzquierda/subirParedIzquierda3.png'],
            fallRight: ['assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha1.png', 'assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha2.png', 'assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha3.png', 'assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha4.png', 'assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha5.png', 'assets/cat/animaciones/CaerMuroDerecha/cayendoMuroDerecha6.png'],
            fallLeft: ['assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda1.png', 'assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda2.png', 'assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda3.png', 'assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda4.png', 'assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda5.png', 'assets/cat/animaciones/CaerMuroIzquierda/cayendoMuroIzquierda6.png']
        };

        // Pet position
        this.position = { x: 20, y: -25 };

        // Animation state
        this.currentAnimation = 'walkRight';
        this.currentFrame = 0;
        this.animationSpeed = 300;
        this.isAnimating = false;
        this.isMoving = false;
        this.behaviorInterval = null;

        // Touch interaction
        this.clickCount = 0;
        this.clickTimeout = null;

        this.init();
    }

    removeExistingPets() {
        // Remove any existing pet containers
        document.querySelectorAll('.pet-sprite-container').forEach(el => el.remove());
        document.querySelectorAll('.pet-status-message').forEach(el => el.remove());
    }

    destroy() {
        this.isAnimating = false;
        if (this.behaviorInterval) {
            clearInterval(this.behaviorInterval);
            this.behaviorInterval = null;
        }
        if (this.petContainer) {
            this.petContainer.remove();
            this.petContainer = null;
        }
        if (this.statusMessage) {
            this.statusMessage.remove();
            this.statusMessage = null;
        }
        petCatInstance = null;
    }

    init() {
        this.createPetElements();
        this.updatePosition();
        this.playAnimation('walkRight');
        this.setupEventListeners();
        this.startAutoBehavior();
    }

    createPetElements() {
        this.petContainer = document.createElement('div');
        this.petContainer.className = 'pet-sprite-container';
        this.petContainer.id = 'petContainer';

        this.petSprite = document.createElement('img');
        this.petSprite.className = 'pet-sprite';
        this.petSprite.id = 'petSprite';
        this.petSprite.alt = 'Gato';

        this.petContainer.appendChild(this.petSprite);

        this.statusMessage = document.createElement('div');
        this.statusMessage.className = 'pet-status-message';
        this.statusMessage.id = 'petStatusMessage';

        document.body.appendChild(this.petContainer);
        document.body.appendChild(this.statusMessage);
    }

    setupEventListeners() {
        if (!this.petSprite) return;
        this.petSprite.addEventListener('click', (e) => this.onPetClick(e));
        this.petSprite.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.onPetClick(e);
        });
    }

    updatePosition() {
        if (!this.petContainer) return;
        this.petContainer.style.left = `${this.position.x}%`;
        this.petContainer.style.bottom = `${this.position.y}px`;
        this.petContainer.style.transform = 'translateX(-50%)';
    }

    playAnimation(animationName, loop = true, callback = null) {
        if (this.isAnimating && !loop) return;
        this.currentAnimation = animationName;
        this.currentFrame = 0;
        this.isAnimating = true;

        const frames = this.animations[animationName];
        let frameCount = 0;

        const animateFrames = () => {
            if (!this.isAnimating || !this.petSprite) return;
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

    showMessage(message) {
        if (!this.statusMessage) return;
        this.statusMessage.textContent = message;
        this.statusMessage.classList.add('show');
        setTimeout(() => {
            if (this.statusMessage) this.statusMessage.classList.remove('show');
        }, 2000);
    }

    onPetClick(e) {
        this.clickCount++;
        if (this.clickTimeout) clearTimeout(this.clickTimeout);

        this.clickTimeout = setTimeout(() => {
            if (this.clickCount === 1) this.petInteraction();
            else if (this.clickCount === 2) this.playInteraction();
            else if (this.clickCount >= 3) this.sleepInteraction();
            this.clickCount = 0;
        }, 300);
    }

    petInteraction() {
        this.showMessage('¡Me encanta! 💕');
        this.playAnimation('lick', false, () => this.playAnimation('walkRight'));
    }

    playInteraction() {
        this.showMessage('¡Qué divertido! 🎾');
        const anims = ['climbRight', 'fallRight', 'meow', 'yawn'];
        const randomAnim = anims[Math.floor(Math.random() * anims.length)];
        this.playAnimation(randomAnim, false, () => this.playAnimation('walkRight'));
    }

    sleepInteraction() {
        this.showMessage('Zzz... 😴');
        this.playAnimation('yawn', false, () => {
            this.playAnimation('sleep');
            setTimeout(() => {
                this.showMessage('¡Buenos días! 😸');
                this.playAnimation('yawn', false, () => this.playAnimation('walkRight'));
            }, 5000);
        });
    }

    startAutoBehavior() {
        const performBehavior = () => {
            if (this.isMoving || !this.petContainer) {
                setTimeout(performBehavior, 2000);
                return;
            }

            const behaviors = ['walk', 'meow', 'lick', 'yawn'];
            const randomBehavior = behaviors[Math.floor(Math.random() * behaviors.length)];

            switch (randomBehavior) {
                case 'walk':
                    const targetX = Math.random() * 70 + 15;
                    const direction = targetX > this.position.x ? 'walkRight' : 'walkLeft';
                    this.isMoving = true;
                    this.isAnimating = false;

                    setTimeout(() => this.playAnimation(direction, true), 50);
                    setTimeout(() => {
                        this.position.x = targetX;
                        this.position.y = -25;
                        this.updatePosition();
                    }, 100);
                    setTimeout(() => {
                        this.isMoving = false;
                        this.isAnimating = false;
                        setTimeout(performBehavior, 3000 + Math.random() * 5000);
                    }, 10500);
                    break;

                case 'meow':
                case 'lick':
                case 'yawn':
                    this.isAnimating = false;
                    setTimeout(() => {
                        this.playAnimation(randomBehavior, false, () => {
                            setTimeout(performBehavior, 2000 + Math.random() * 3000);
                        });
                    }, 50);
                    break;
            }
        };

        setTimeout(performBehavior, 3000);

        this.behaviorInterval = setInterval(() => {
            if (!this.isAnimating && !this.isMoving && Math.random() < 0.15) {
                const behaviors = ['meow', 'lick', 'yawn'];
                const anim = behaviors[Math.floor(Math.random() * behaviors.length)];
                this.playAnimation(anim, false, () => this.playAnimation('walkRight'));
            }
        }, 15000);
    }
}

// Pet Cat Manager - handles toggle functionality
const PetCatManager = {
    isPetEnabled() {
        const saved = localStorage.getItem('pet-cat-enabled');
        return saved === null ? true : saved === 'true';
    },

    setPetEnabled(enabled) {
        localStorage.setItem('pet-cat-enabled', enabled.toString());
        if (enabled) {
            if (!petCatInstance) {
                petCatInstance = new PetCat();
            }
        } else {
            if (petCatInstance) {
                petCatInstance.destroy();
                petCatInstance = null;
            }
            // Also clean up any orphaned elements
            document.querySelectorAll('.pet-sprite-container').forEach(el => el.remove());
            document.querySelectorAll('.pet-status-message').forEach(el => el.remove());
        }
    },

    init() {
        // Only initialize once
        if (petCatInstance) return;

        if (this.isPetEnabled()) {
            petCatInstance = new PetCat();
        }
    },

    setupToggle() {
        if (petToggleInitialized) return;

        const checkbox = document.getElementById('pet-cat-enabled');
        if (!checkbox) return;

        // Set initial state
        checkbox.checked = this.isPetEnabled();

        // Add listener (only once)
        checkbox.addEventListener('change', (e) => {
            this.setPetEnabled(e.target.checked);
        });

        petToggleInitialized = true;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize pet after a short delay to ensure DOM is ready
    setTimeout(() => {
        PetCatManager.init();
        PetCatManager.setupToggle();
    }, 1000);
});

// Expose for external access
window.PetCatManager = PetCatManager;
