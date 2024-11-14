# -*- coding: utf-8 -*-
import sys

# Forcer l'encodage UTF-8 pour la sortie standard
sys.stdout.reconfigure(encoding='utf-8')

def main():
    if len(sys.argv) < 2:
        print("No module provided.")
        return

    module = sys.argv[1]
    if module == "pandas":
        print("Utilisation de 'pandas' détectée.")
    elif module == "numpy":
        print("Utilisation de 'numpy' détectée.")
    else:
        print("Module non reconnu.")

if __name__ == "__main__":
    main()
