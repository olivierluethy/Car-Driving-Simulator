function changeRoad(num) {
    if (num == 1) {
        document.querySelector(".route").src = "images/Rennstrecke1.png";
        selectedMap(1);
    } else if (num == 2) {
        document.querySelector(".route").src = "images/Rennstrecke2.png";
        selectedMap(2);
    } else if (num == 3) {
        document.querySelector(".route").src = "images/slalom.png";
        selectedMap(3);
    }
}

function selectedMap(num) {
    elements = document.querySelector(".dropdown-content").getElementsByClassName("imageandtext");
    for (var i = 1; i <= elements.length; i++) {
        if (i == num) {
            elements[(i - 1)].style.backgroundColor = "red";
        } else {
            elements[(i - 1)].style.backgroundColor = "white";
        }
    }
}

function selectedCar(num) {
    console.log("wird aufgeruen");
    elements = document.getElementsByClassName("imageandtext2");
    for (var i = 1; i <= elements.length; i++) {
        console.log(i);
        if (i == num) {
            elements[(i - 1)].style.backgroundColor = "red";
        } else {
            elements[(i - 1)].style.backgroundColor = "white";
        }
    }
}

function changeCar(num) {
    if (num == 1) {
        document.querySelector(".car").src = "images/car.png";
        selectedCar(1);
    } else if (num == 2) {
        document.querySelector(".car").src = "images/car2.png";
        selectedCar(2);
    } else if (num == 3) {
        document.querySelector(".car").src = "images/car3.png";
        selectedCar(3);
    } else if (num == 4) {
        document.querySelector(".car").src = "images/car4.png";
        selectedCar(4);
    } else if (num == 5) {
        document.querySelector(".car").src = "images/car5.png";
        selectedCar(5);
    } else if (num == 6) {
        document.querySelector(".car").src = "images/car6.png";
        selectedCar(6);
    } else if (num == 7) {
        document.querySelector(".car").src = "images/car7.png";
        selectedCar(7);
    } else if (num == 8) {
        document.querySelector(".car").src = "images/car8.png";
        selectedCar(8);
    } else if (num == 9) {
        document.querySelector(".car").src = "images/car9.png";
        selectedCar(9);
    }
}