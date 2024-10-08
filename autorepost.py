import pyautogui
import time

print("Move your mouse to the desired location within 5 seconds...")
time.sleep(5)  # Wait for 5 seconds to allow you to position your mouse
print(pyautogui.position())  # Output the current mouse position
